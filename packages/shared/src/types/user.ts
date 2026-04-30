export interface User {
  id: string;
  googleId: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  createdAt: Date;
}

export interface UserPreferences {
  userId: string;
  theme: 'system' | 'light' | 'dark';
  compactMode: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  lastDigestSentAt: Date | null;
}

export interface UserRegion {
  id: string;
  userId: string;
  cityName: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  active: boolean;
}
