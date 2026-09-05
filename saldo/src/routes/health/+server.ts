import { json } from '@sveltejs/kit';

export const prerender = false;

export function GET() {
  return json({ estado: 'ok', version: '0.1.0' });
}
