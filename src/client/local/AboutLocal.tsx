export function AboutLocal() {
  return <div className="space-y-4 text-sm leading-relaxed">
    <h2 className="text-lg font-semibold">Inkstone · 1.0.3</h2>
    <p>笔记、附件、字体和设置保存在本机应用的私有数据库中，无需账号、服务器、域名或网络。</p>
    <p>通过「数据」导出完整 ZIP 备份，可保存到你选择的文件夹。JSON 仅供文本交换，不包含附件文件。</p>
    <p>安装同一签名的新版本可保留数据。卸载应用或清除应用数据会删除本地笔记，请提前导出 ZIP 备份。</p>
    <p>本地版与网页各自保存笔记，可通过 ZIP 导入导出迁移。云同步、公开分享和远程 MCP 不在本地版提供。</p>
    <p><a className="text-[var(--accent)] underline" href="https://github.com/gugugudaxi-sketch/inkstone/tree/android-local">源码与构建说明</a> · <a className="text-[var(--accent)] underline" href="/LICENSE.txt" download="Inkstone-LGPL-3.0.txt">开源许可证</a></p>
    <p className="text-xs text-[var(--text-tertiary)]">基于 shuaiplus/inkstone，遵循 LGPL-3.0-only。源代码和构建说明随版本提供。</p>
  </div>
}
