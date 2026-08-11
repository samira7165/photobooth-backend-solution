// Every /api/v1/public/* success response is wrapped in this shape —
// see public-api-exception.filter.ts for the matching error shape.
export function wrapSuccess<T>(data: T) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}
