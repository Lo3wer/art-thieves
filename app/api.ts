import { Platform } from 'react-native';

const EMULATOR_LOCALHOST = Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';

export const API_BASE = process.env.EXPO_PUBLIC_API_URL || EMULATOR_LOCALHOST;
