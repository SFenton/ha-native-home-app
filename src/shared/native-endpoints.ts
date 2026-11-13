// Only verified, named bridge endpoints belong here; arbitrary paths are never accepted.
export const nativeHomeEndpoints: Readonly<Record<string, string>> = {
  'push-config': '/api/fenton_home/config',
  'house-states': 'fenton_home/house_config',
  'house-profile': 'auth/current_user',
};
