import client from './client';

export const login = (data) => client.post('/auth/login', data);
export const register = (data) => client.post('/auth/register', data);
// Second step of a login for an account with 2FA: { twoFactorToken, code }.
export const loginTwoFactor = (data) => client.post('/auth/login/2fa', data);
export const getProfile = () => client.get('/auth/profile');
export const logout = () => client.post('/auth/logout');