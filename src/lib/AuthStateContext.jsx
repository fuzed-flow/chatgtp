import { createContext, useContext } from "react";

export const AuthStateContext = createContext({});
export const useAuthState = () => useContext(AuthStateContext);

