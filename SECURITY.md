# Security Policy

PATCH intentionally sits close to user data and application control. Security issues involving credential exposure, renderer escape, permission bypass, arbitrary code execution, adapter authentication bypass, prompt-injection policy bypass, or destructive action without confirmation should be treated as high priority.

Do not include API keys, screenshots, passwords, private documents, or provider payloads in issue reports. Provide redacted logs and a minimal reproduction instead.

Before a public release, configure a private vulnerability-reporting address/process and code-sign the Windows installer and native sidecar.

See `docs/THREAT_MODEL.md` for the system threat model and `DECISIONS.md` for security-relevant architecture choices.
