import type { AuthResponse, AuthUser, ForgotPasswordInput, LoginInput, RegisterInput, RegisterResponse, ResetPasswordWithCodeInput } from '@jr/shared';
import { api } from '@/lib/api';

export const login = (input: LoginInput) => api.post<AuthResponse>('/auth/login', input);
export const register = (input: RegisterInput) => api.post<RegisterResponse>('/auth/register', input);
export const verifyRegistration = (userId: string, code: string) => api.post<AuthResponse>('/auth/register/verify', { userId, code });
export const resendRegistrationCode = (userId: string) => api.post<RegisterResponse>('/auth/register/resend', { userId });
export const requestPasswordReset = (input: ForgotPasswordInput) => api.post<{ message: string; channel: string }>('/auth/forgot-password', input);
export const resetPassword = (input: ResetPasswordWithCodeInput) => api.post<{ message: string }>('/auth/reset-password', input);
export const logout = () => api.post<void>('/auth/logout', {}, { csrf: true });
export const fetchMe = () => api.get<{ user: AuthUser }>('/auth/me');
