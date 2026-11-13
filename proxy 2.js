import { NextResponse } from 'next/server';

const CORS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function proxy(request) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS });
  }
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
