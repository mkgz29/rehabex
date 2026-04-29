import { createContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

export type Profile = {
  id: string;
  role: 'admin' | 'user';
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setProfile(null);
      setProfileUserId(null);
      setLoadingAuth(false);
      setLoadingProfile(false);
      return undefined;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) {
        return;
      }

      console.log('AuthProvider session:', data.session);

      if (error) {
        console.error('Error cargando sesion.', error);
        setSession(null);
      } else {
        setSession(data.session);
      }

      setLoadingAuth(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoadingAuth(false);

      if (!nextSession?.user) {
        setProfile(null);
        setProfileUserId(null);
        setLoadingProfile(false);
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user.id ?? null;

    console.log('AuthProvider user.id:', userId);

    if (!supabase || !userId) {
      setProfile(null);
      setProfileUserId(null);
      setLoadingProfile(false);
      return undefined;
    }

    let mounted = true;

    setProfile(null);
    setProfileUserId(null);
    setLoadingProfile(true);

    supabase
      .from('profiles')
      .select('id, role')
      .eq('id', userId)
      .single()
      .then((result) => {
        if (!mounted) {
          return;
        }

        const { data, error } = result;
        console.log('AuthProvider profiles result:', result);

        if (error) {
          console.error('Error cargando profile de usuario.', error);
          setProfile(null);
        } else {
          const nextProfile = normalizeProfile(data);
          console.log('AuthProvider profile final:', nextProfile);
          setProfile(nextProfile);
        }

        setProfileUserId(userId);
        setLoadingProfile(false);
      });

    return () => {
      mounted = false;
    };
  }, [session?.user.id]);

  const user = session?.user ?? null;
  const profilePending = Boolean(user && profileUserId !== user.id);
  const loading = loadingAuth || loadingProfile || profilePending;
  const isAdmin = profile?.role === 'admin';

  console.log('AuthProvider isAdmin calculado:', isAdmin);
  console.log('AuthProvider loading:', {
    loading,
    loadingAuth,
    loadingProfile,
    profilePending,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      isAdmin,
      loading,
      async signIn(email: string, password: string) {
        if (!supabase) {
          throw new Error('Supabase no esta configurado para iniciar sesion.');
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw new Error(error.message || 'No se pudo iniciar sesion.');
        }

        setSession(data.session);
      },
      async signUp(email: string, password: string) {
        if (!supabase) {
          throw new Error('Supabase no esta configurado para registrar usuarios.');
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          throw new Error(error.message || 'No se pudo crear la cuenta.');
        }
      },
      async signOut() {
        if (!supabase) {
          setSession(null);
          setProfile(null);
          setProfileUserId(null);
          return;
        }

        const { error } = await supabase.auth.signOut();
        if (error) {
          throw new Error(error.message || 'No se pudo cerrar la sesion.');
        }

        setSession(null);
        setProfile(null);
        setProfileUserId(null);
        setLoadingProfile(false);
      },
    }),
    [isAdmin, loading, profile, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function normalizeProfile(profile: { id: string; role: string | null }): Profile {
  return {
    id: profile.id,
    role: profile.role === 'admin' ? 'admin' : 'user',
  };
}
