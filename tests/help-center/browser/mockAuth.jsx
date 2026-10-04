import React, { createContext, useContext } from 'react';
const Context=createContext(null);
export function MockAuth({role='owner',children}) { return <Context.Provider value={{profile:{id:'fixture-user',company_id:'fixture-company',role,full_name:'Preview User',onboarding_completed:true},company:{id:'fixture-company',name:'Preview Company'},signOut:()=>{}}}>{children}</Context.Provider>; }
export const useAuth=()=>useContext(Context);
