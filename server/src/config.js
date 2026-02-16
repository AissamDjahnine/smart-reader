import path from 'path';

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  appBaseUrl: process.env.APP_BASE_URL || '',
  uploadsDir: process.env.EPUB_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads', 'epubs')
};
