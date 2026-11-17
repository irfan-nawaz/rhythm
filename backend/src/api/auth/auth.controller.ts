import { hash, verify } from '@node-rs/argon2';
import { Body, Controller, HttpCode, Inject, Injectable, Post, Req, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isUniqueViolation, type Sql } from '../../db.js';
import { isValidTimezone } from '../../domain/schedule.js';
import { SQL } from '../../infra.module.js';
import { authAttempts } from '../../metrics.js';
import { Public, strictRateLimit } from '../common/auth.js';
import { conflict, unauthorized } from '../common/errors.js';
import { createSession, destroySession, type SessionUser } from '../common/session.js';

const registerBody = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.email().max(200),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  timezone: z.string().max(64).optional(),
});
type RegisterBody = z.infer<typeof registerBody>;

const loginBody = z.object({ email: z.string().max(200), password: z.string().max(200) });
type LoginBody = z.infer<typeof loginBody>;

@Injectable()
export class AuthService {
  // Hashing is deliberately slow: argon2id uses about 19 MB of memory and real
  // CPU time per call. That protects passwords, and it also makes sign-in the
  // most expensive endpoint under load.
  private dummyHash?: Promise<string>;

  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async register(body: RegisterBody): Promise<SessionUser> {
    const email = body.email.toLowerCase();
    const timezone = body.timezone && isValidTimezone(body.timezone) ? body.timezone : 'Asia/Kolkata';
    const passwordHash = await hash(body.password);
    try {
      return await this.sql.begin(async (tx) => {
        const [user] = await tx<SessionUser[]>`
          insert into users (email, password_hash, name, timezone)
          values (${email}, ${passwordHash}, ${body.name}, ${timezone})
          returning id, email, name, timezone`;
        const [group] = await tx`
          insert into groups (name, kind, timezone, created_by)
          values ('Personal', 'personal', ${timezone}, ${user.id}) returning id`;
        await tx`insert into members (group_id, user_id, name, role) values (${group.id}, ${user.id}, ${body.name}, 'owner')`;
        return user;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('An account with this email already exists', 'email_taken');
      throw err;
    }
  }

  /** Returns the user, or null for a wrong email or password. */
  async verify(body: LoginBody): Promise<SessionUser | null> {
    const [user] = await this.sql<(SessionUser & { passwordHash: string })[]>`
      select id, email, name, timezone, password_hash from users where lower(email) = lower(${body.email})`;
    // Check against a dummy hash when the email is unknown, so response times
    // don't reveal which emails have accounts.
    this.dummyHash ??= hash('not-a-real-password');
    const valid = await verify(user?.passwordHash ?? (await this.dummyHash), body.password);
    if (!user || !valid) return null;
    return { id: user.id, email: user.email, name: user.name, timezone: user.timezone };
  }
}

@Public()
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @RouteConfig(strictRateLimit)
  async register(
    @Body({ schema: registerBody }) body: RegisterBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    try {
      const user = await this.auth.register(body);
      await createSession(req, reply, user.id);
      authAttempts.inc({ action: 'register', result: 'success' });
      return { user };
    } catch (err) {
      authAttempts.inc({ action: 'register', result: 'failure' });
      throw err;
    }
  }

  @Post('login')
  @HttpCode(200)
  @RouteConfig(strictRateLimit)
  async login(@Body({ schema: loginBody }) body: LoginBody, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const user = await this.auth.verify(body);
    if (!user) {
      authAttempts.inc({ action: 'login', result: 'failure' });
      throw unauthorized();
    }
    await createSession(req, reply, user.id);
    authAttempts.inc({ action: 'login', result: 'success' });
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await destroySession(req, reply);
  }
}
