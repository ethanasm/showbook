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
  digestFrequency: 'daily' | 'weekly' | 'off';
  digestTime: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  showDayReminder: boolean;
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
