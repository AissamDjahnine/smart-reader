import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

export const signToken = (user) => jwt.sign(
  { sub: user.id, email: user.email },
  config.jwtSecret,
  { expiresIn: config.jwtExpiresIn }
);

export const verifyToken = (token) => jwt.verify(token, config.jwtSecret);

export const hashPassword = async (password) => bcrypt.hash(password, 10);

export const comparePassword = async (password, hash) => bcrypt.compare(password, hash);
