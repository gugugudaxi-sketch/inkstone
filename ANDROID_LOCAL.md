# Inkstone Android 本地版

此分支提供独立本地构建；`main` 分支的 Cloudflare 网页继续独立使用。

- 无 INTERNET 权限；应用界面、渲染器和字体随 APK 安装。
- 笔记、目录、标签、历史、附件、字体、设置在应用私有存储中。
- 默认无需注册登录。云同步、远程 MCP、公开分享和远程备份不提供。
- 同一个包名和签名的新 APK 覆盖安装保留数据；卸载或清除数据会删除笔记。
- 使用设置 → 数据 → ZIP 导出做完整备份；JSON 不包含附件。
- 当前本地数据库版本 1 不在启动时自动清空数据，写入失败不会返回成功。
- 需要 Android 8+ 和近期 Android System WebView（支持 ES2022、structuredClone）。

## 构建

Node 24.15.0、JDK 17、Gradle 8.11.1、Android SDK 35。

```sh
npm ci
npm run test:unit
npm run build:local
mkdir -p android/app/src/main/assets
cp -R dist/local/. android/app/src/main/assets/
cp LICENSE android/app/src/main/assets/LICENSE.txt
cd android
gradle :app:assembleDebug :app:assembleRelease
```

GitHub Actions 的 `Android local APK` 工作流执行构建、检查无联网权限并运行 Android WebView 的真实持久化/附件测试。
`inkstone-local-unsigned` 产物包含未签名 APK 和 apksigner.jar。未签名 APK 不能直接安装。

正式自用包要用自己的私钥签名，并安全保留该私钥以便后续覆盖升级。不要将私钥提交到公开仓库。

```sh
java -jar apksigner.jar sign --ks /path/to/private.jks --ks-key-alias inkstone --out inkstone-local.apk inkstone-local-1.0.0-unsigned.apk
java -jar apksigner.jar verify --verbose inkstone-local.apk
```

也可通过环境变量 INKSTONE_KEYSTORE、INKSTONE_STORE_PASSWORD、INKSTONE_KEY_ALIAS、INKSTONE_KEY_PASSWORD 配置 Gradle release 签名。

## 首次验收

1. 飞行模式首次打开 APK，创建笔记并调整设置。
2. 上传图片和字体、引用图片，关闭应用后重启确认保留。
3. ZIP 导出到系统文件夹；在另一台测试设备导入检查内容、附件、字体。
4. Android 返回手势关闭弹层或返回列表。
5. 网页与本地版不自动同步；通过文件手动迁移。

## 许可

继承上游 LGPL-3.0-only，完整源代码与修改保持可取得。本地 Android 容器属于该分支源码。
当前未提供应用 PIN 锁或数据库单独加密；数据受 Android 应用沙箱保护。
