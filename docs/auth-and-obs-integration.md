# Auth and OBS Integration

This desktop client now supports an external auth service and an external OBS upload service.

## Settings

Configure in app settings payload (`settings:update`) or config file:

```json
{
  "auth": {
    "enabled": true,
    "serviceUrl": "https://auth.example.com",
    "realm": "prod",
    "ssoProvider": "adfs",
    "adDomain": "corp.example.com"
  },
  "obs": {
    "enabled": true,
    "serviceUrl": "https://auth.example.com",
    "bucket": "clawwork-files",
    "basePath": "desktop"
  }
}
```

## Auth API Contract

- `POST /api/auth/login`
- Request: `{ username, password, realm?, adDomain?, provider: "password", deviceId }`
- Response: `{ token, refreshToken?, expiresAt?, provider?, user? }`

- `POST /api/auth/sso/start`
- Request: `{ provider?, realm?, adDomain?, deviceId }`
- Response: `{ verificationUri, userCode?, deviceCode, expiresIn?, intervalMs? }`

- `POST /api/auth/sso/poll`
- Request: `{ provider?, deviceCode, deviceId }`
- Response: `{ done, token?, refreshToken?, expiresAt?, provider?, user? }`

The service can be implemented with PostgreSQL for user/session storage and AD/SSO federation.

## OBS Upload API Contract

- `POST /api/obs/upload`
- Request: `{ gatewayId, taskId?, sessionKey, bucket?, basePath?, files: [{ mimeType, fileName, content(base64) }] }`
- Response: `{ files: [{ fileName, objectKey?, url?, openclawPath? }] }`

Uploaded file locations are injected into the outbound chat content as `<clawwork_uploaded_files>` metadata for the current session.
