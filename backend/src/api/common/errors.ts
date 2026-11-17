import {
  BadRequestException,
  Catch,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { isForeignKeyViolation, isUniqueViolation } from '../../db.js';
import { InvalidInputError } from '../../domain/errors.js';

// Every error leaves the API in one shape: { error: { code, message, details? } }.

export const badRequest = (message: string) => new BadRequestException({ code: 'bad_request', message });
export const unauthorized = () => new UnauthorizedException({ code: 'unauthorized', message: 'Please sign in' });
export const forbidden = (message = "You don't have permission to do that") => new ForbiddenException({ code: 'forbidden', message });
export const notFound = (what: string) => new NotFoundException({ code: 'not_found', message: `${what} not found` });
export const conflict = (message: string, code = 'conflict') => new ConflictException({ code, message });

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

interface Issue {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

/** Used by the global StandardSchemaValidationPipe when a request fails its Zod schema. */
export function validationException(issues: readonly Issue[]) {
  const details = issues.map((issue) => ({
    path: (issue.path ?? []).map((part) => String(typeof part === 'object' ? part.key : part)).join('.'),
    message: issue.message,
  }));
  return new BadRequestException({ code: 'invalid_request', message: 'Some fields are invalid', details });
}

const codes: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
  503: 'unavailable',
};

function toErrorResponse(err: unknown): { status: number; body: { error: ErrorBody }; unexpected: boolean } {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const response = err.getResponse();
    if (typeof response === 'object' && response !== null && 'code' in response) {
      return { status, body: { error: response as ErrorBody }, unexpected: false };
    }
    const raw = typeof response === 'string' ? response : ((response as { message?: unknown }).message ?? err.message);
    const message = Array.isArray(raw) ? raw.join('; ') : String(raw);
    return { status, body: { error: { code: codes[status] ?? 'error', message } }, unexpected: false };
  }
  if (err instanceof InvalidInputError) {
    return { status: 400, body: { error: { code: 'bad_request', message: err.message } }, unexpected: false };
  }
  if (isUniqueViolation(err)) {
    return { status: 409, body: { error: { code: 'conflict', message: 'That already exists' } }, unexpected: false };
  }
  if (isForeignKeyViolation(err)) {
    const message = "It's still in use, or refers to something that doesn't exist";
    return { status: 409, body: { error: { code: 'conflict', message } }, unexpected: false };
  }
  // Errors raised by Fastify or its plugins: bad JSON, body too large, rate limited, ...
  const status = (err as FastifyError | undefined)?.statusCode;
  if (status && status >= 400 && status < 500) {
    const message = (err as Error).message ?? 'Request error';
    return { status, body: { error: { code: codes[status] ?? (err as FastifyError).code ?? 'error', message } }, unexpected: false };
  }
  return { status: 500, body: { error: { code: 'internal', message: 'Something went wrong' } }, unexpected: true };
}

/** Formats every error: from controllers, services, guards and pipes, and from Fastify itself. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { status, body, unexpected } = toErrorResponse(err);
    if (unexpected) req.log.error({ err }, 'unhandled error');
    void reply.status(status).send(body);
  }
}
