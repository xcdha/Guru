const GURU_REPO_URL = 'https://github.com/xcdha/Guru'

let _appVersion = '0.0.0'

export function setAppVersion(version: string): void {
  _appVersion = version
}

export function getAppVersion(): string {
  return _appVersion
}

export function getAppUserAgent(version?: string): string {
  const v = version ?? _appVersion
  return `Guru/${v} (+${GURU_REPO_URL})`
}
