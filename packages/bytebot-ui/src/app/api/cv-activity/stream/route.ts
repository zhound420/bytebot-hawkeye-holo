import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const baseUrl = process.env.BYTEBOT_AGENT_BASE_URL || 'http://localhost:9991';

    const response = await fetch(`${baseUrl}/cv-activity/stream`, {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch CV activity stream' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('CV activity stream fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
