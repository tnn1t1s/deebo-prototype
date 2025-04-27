export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: string;
}

export interface DoctorConfig {
  verbose: boolean;
  deeboPath: string;
  logPath?: string;
}

export interface SystemCheck {
  name: string;
  check: (config: DoctorConfig) => Promise<CheckResult>;
  fix?: (config: DoctorConfig) => Promise<void>;
}
