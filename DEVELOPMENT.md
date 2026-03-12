# Development

## 开发

```bash
pnpm install
pnpm --filter @clawwork/desktop dev
```

## 打包 (unsigned dmg)

```bash
pnpm --filter @clawwork/desktop run build:dmg
```

产物在 `packages/desktop/dist/ClawWork-<version>-arm64.dmg`。

未签名，首次打开需右键 → 打开。
