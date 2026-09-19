const GURU_REPO_URL = 'https://github.com/ErlichLiu/Guru'

let _guruVersion = '0.0.0'

export function setGuruVersion(version: string): void {
  _guruVersion = version
}

export function getGuruVersion(): string {
  return _guruVersion
}

export function getGuruUserAgent(version?: string): string {
  const v = version ?? _guruVersion
  return `Guru/${v} (+${GURU_REPO_URL})`
}
