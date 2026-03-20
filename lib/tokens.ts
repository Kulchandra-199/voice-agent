import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export function getValidAccessToken(): Promise<string> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error('GOOGLE_REFRESH_TOKEN is not configured');
  }

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return oauth2Client.getAccessToken().then(({ token }) => {
    if (!token) {
      throw new Error('Failed to get access token');
    }
    return token as string;
  });
}

export function getAuthUrl(): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    prompt: 'consent', // force refresh_token to be returned
  });
}

export function getOAuth2Client() {
  return oauth2Client;
}