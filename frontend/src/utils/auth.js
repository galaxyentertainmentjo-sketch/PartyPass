const USER_KEY = "pp_user";
const TOKEN_KEY = "pp_token";

export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
};

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const setAuth = (user, token) => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(TOKEN_KEY, token);
};

export const clearAuth = () => {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
};
