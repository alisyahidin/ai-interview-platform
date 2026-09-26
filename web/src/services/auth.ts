import api from "./api";

export interface LoginPayload {
  email: string;
  password: string;
}

// #43: matches the real Auth::Authentication contract -- both `admin` and
// `user` roles succeed here now, and the response carries the user's
// organization_id derived from their own record (not a JWT claim). The
// frontend doesn't currently branch on `user`'s fields, but the type
// reflects what the backend actually returns rather than only the field
// LoginPage happens to read today.
export interface LoginResponse {
  token: string;
  user: {
    id: number;
    email: string;
    role: string;
    organization_id: number | null;
  };
}

export interface RegisterPayload {
  email: string;
  password: string;
  invitation_token: string;
}

export interface RegisterResponse {
  message: string;
}

export const authApi = {
  login: (data: LoginPayload) =>
    api.post<LoginResponse>("/auth/login", data),

  // #38/#42: registration is invitation-only and never accepts a `role` --
  // the backend (Auth::Registration) never reads one even if sent, so it's
  // not part of this payload's shape at all. Does not return a token or log
  // the user in; on success the caller sends them to /login.
  signup: (data: RegisterPayload) =>
    api.post<RegisterResponse>("/auth/register", data),
};
