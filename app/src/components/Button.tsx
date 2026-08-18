import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'warning';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: '#1a1a2e',
  secondary: '#ffffff',
  danger: '#e74c3c',
  success: '#2ecc71',
  warning: '#f39c12',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  disabledReason,
  loading = false,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <View style={style}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        disabled={inactive}
        style={[
          styles.base,
          { backgroundColor: VARIANT_BG[variant] },
          variant === 'secondary' && styles.secondaryBorder,
          inactive && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={[styles.text, inactive && styles.textDisabled]}>{label}</Text>
        )}
      </TouchableOpacity>
      {disabled && !loading && disabledReason ? (
        <Text style={styles.reason}>{disabledReason}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBorder: {
    borderWidth: 1,
    borderColor: '#c8c8c8',
  },
  disabled: {
    backgroundColor: '#c7c7cc',
    borderColor: '#c7c7cc',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  textDisabled: {
    color: '#f0f0f0',
  },
  reason: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 6,
  },
});
