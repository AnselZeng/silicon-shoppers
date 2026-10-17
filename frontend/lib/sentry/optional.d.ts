declare module "@sentry/nextjs" {
  export function setContext(name: string, context: Record<string, unknown> | null): void
}
