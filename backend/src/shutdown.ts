// Graceful shutdown is handled by Nest (enableShutdownHooks in each main.ts):
// on SIGTERM it runs beforeApplicationShutdown hooks, closes the HTTP server
// (waiting for in-flight requests), then runs onApplicationShutdown hooks,
// which close the database, cache and queue connections.
//
// Kubernetes sends SIGTERM and waits terminationGracePeriodSeconds (30 s by
// default) before killing the process. Run node directly as the container's
// main process, not through `npm start`, or the signal may never arrive.

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
