const MAP_STYLE = process.env.EXPO_PUBLIC_MAP_STYLE || 'https://tiles.openfreemap.org/styles/liberty';

module.exports = {
  expo: {
    name: 'Vancouver Art Thieves',
    slug: 'vancouver-art-thieves',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      package: 'com.leozhang226.vancouverartthieves',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: ['@maplibre/maplibre-react-native'],
    extra: {
      mapStyle: MAP_STYLE,
    },
  },
};
