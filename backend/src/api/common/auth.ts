import { createParamDecorator, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { unauthorized } from './errors.js';
import type { SessionUser } from './session.js';

const IS_PUBLIC = 'rhythm:isPublic';

/** Marks a route (or a whole controller) as open to signed-out visitors. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Injects the signed-in user into a controller method. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest<FastifyRequest>().user!,
);

/** Every route requires a signed-in user unless it is marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    if (!ctx.switchToHttp().getRequest<FastifyRequest>().user) throw unauthorized();
    return true;
  }
}

/**
 * Stricter rate limit for sign-in and registration: per IP address, to slow
 * down password guessing. Use with @RouteConfig(strictRateLimit).
 */
export const strictRateLimit = {
  rateLimit: {
    max: config.RATE_LIMIT_AUTH_MAX,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => `auth:${req.ip}`,
  },
};

/** Health checks are never rate limited. */
export const noRateLimit = { rateLimit: false };
