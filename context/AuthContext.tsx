'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';

type UserRole = 'CEO' | 'ADMIN' | 'MEMBER' | 'GUEST';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: UserRole;
  isLoading: boolean;
  signInWithKakao: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const CEO_EMAIL = process.env.NEXT_PUBLIC_CEO_EMAIL || '';
const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim());

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>('GUEST');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Initial Session Check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        syncProfile(session.user);
      } else {
        setIsLoading(false);
      }
    });

    // 2. Auth State Change Listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await syncProfile(session.user);
      } else {
        setRole('GUEST');
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const syncProfile = async (currentUser: User) => {
    try {
      // Determine Role based on Email Auto-Promotion
      let targetRole: UserRole = 'GUEST';
      if (currentUser.email === CEO_EMAIL) {
        targetRole = 'CEO';
      } else if (ADMIN_EMAILS.includes(currentUser.email || '')) {
        targetRole = 'ADMIN';
      }

      // Upsert into public.profiles
      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: currentUser.id,
          email: currentUser.email,
          role: targetRole,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select()
        .single();

      if (error) {
        console.error('Error syncing profile:', error);
        // Fallback to auto-promoted role even if DB sync fails
        setRole(targetRole);
      } else {
        setRole(data.role as UserRole);
      }
    } catch (err) {
      console.error('Failed to sync profile:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithKakao = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) console.error('Error logging in with Kakao:', error.message);
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Error logging out:', error.message);
  };

  return (
    <AuthContext.Provider value={{ user, session, role, isLoading, signInWithKakao, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
