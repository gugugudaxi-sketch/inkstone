package dev.inkstone.local;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowInsets;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.print.PrintManager;
import androidx.webkit.WebViewAssetLoader;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_FILE = 10, SAVE_FILE = 11;
    private WebView web, printWeb;
    private ValueCallback<Uri[]> fileCallback;
    private final java.util.concurrent.ExecutorService io = Executors.newSingleThreadExecutor();
    private File attachmentDir, exportTemp;
    private FileOutputStream attachmentOutput, downloadOutput;
    private String attachmentId, attachmentMime, downloadName, downloadMime;
    private long attachmentBytes, downloadBytes;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(0xfffaf9f7);
        getWindow().setNavigationBarColor(0xfffaf9f7);
        web = new WebView(this);
        web.setBackgroundColor(0xfffaf9f7);
        setContentView(web);
        // Account for system bars with target SDK 35 edge-to-edge enforcement.
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getStableInsetLeft(), insets.getStableInsetTop(),
                    insets.getStableInsetRight(), insets.getStableInsetBottom());
            }
            return insets;
        });
        attachmentDir = new File(getFilesDir(), "attachments");
        attachmentDir.mkdirs();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !"appassets.androidplatform.net".equals(uri.getHost())) return blocked();
                String path = uri.getPath();
                if (path != null && path.startsWith("/api/files/")) {
                    String id = path.substring("/api/files/".length());
                    if (!validId(id)) return blocked();
                    try {
                        File content = new File(attachmentDir, id);
                        File mimeFile = new File(attachmentDir, id + ".mime");
                        String mime = new String(java.nio.file.Files.readAllBytes(mimeFile.toPath()), StandardCharsets.UTF_8);
                        WebResourceResponse response = new WebResourceResponse(mime, null, new FileInputStream(content));
                        response.setResponseHeaders(Collections.singletonMap("Content-Security-Policy", "sandbox; default-src 'none'"));
                        return response;
                    } catch (IOException error) { return blocked(); }
                }
                if (path == null || path.contains("..") || path.startsWith("/api/")) return blocked();
                WebResourceResponse response = loader.shouldInterceptRequest(uri);
                if (response == null) return blocked();
                Map<String,String> headers = new HashMap<>();
                headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'");
                response.setResponseHeaders(headers);
                return response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (ORIGIN.equals(uri.getScheme() + "://" + uri.getHost()) && "/index.html".equals(uri.getPath())) return false;
                if (request.isForMainFrame() && request.hasGesture() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, PICK_FILE); }
                catch (Exception error) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        web.addJavascriptInterface(new LocalBridge(), "InkstoneNative");
        web.loadUrl(ORIGIN + "/index.html");
    }
    private static boolean validId(String id) { return id != null && id.matches("[0-9a-hjkmnp-tv-z]{26}"); }
    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(),
            new ByteArrayInputStream("Local-only application".getBytes(StandardCharsets.UTF_8)));
    }
    public WebView webForTesting() { return web; }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.inkstoneNativeBack && window.inkstoneNativeBack()", null);
    }
    @Override protected void onPause() {
        web.evaluateJavascript("window.dispatchEvent(new Event('inkstone-local-pause'))", null);
        super.onPause();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        } else if (request == SAVE_FILE) {
            if (result != RESULT_OK || data == null || data.getData() == null) { downloadResult(null); return; }
            Uri target = data.getData();
            io.execute(() -> {
                try (InputStream in = new FileInputStream(exportTemp); OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
                    if (out == null) throw new IOException("文件不可写入");
                    byte[] buffer = new byte[65536]; int n;
                    while ((n = in.read(buffer)) >= 0) out.write(buffer, 0, n);
                    out.flush();
                    downloadResult(null);
                } catch (Exception error) { downloadResult("保存失败，请检查所选文件夹和剩余空间"); }
            });
        }
    }
    private void downloadResult(String error) {
        runOnUiThread(() -> {
            if (exportTemp != null) exportTemp.delete();
            web.evaluateJavascript("window.inkstoneDownloadResult && window.inkstoneDownloadResult(" +
                (error == null ? "null" : org.json.JSONObject.quote(error)) + ")", null);
        });
    }
    public final class LocalBridge {
        @JavascriptInterface public synchronized boolean hasAttachment(String id, long size) {
            File file = new File(attachmentDir, validId(id) ? id : "invalid");
            return validId(id) && file.isFile() && file.length() == size && new File(attachmentDir, id + ".mime").isFile();
        }
        @JavascriptInterface public synchronized boolean beginAttachment(String id, String mime) {
            if (!validId(id) || mime == null || !mime.matches("[a-zA-Z0-9.+_-]+/[a-zA-Z0-9.+_-]+")) return false;
            try {
                if (attachmentOutput != null) attachmentOutput.close();
                attachmentId = id; attachmentMime = mime; attachmentBytes = 0;
                attachmentOutput = new FileOutputStream(new File(attachmentDir, id + ".tmp")); return true;
            } catch (IOException error) { return false; }
        }
        @JavascriptInterface public synchronized boolean appendAttachment(String value) {
            try {
                byte[] data = Base64.decode(value, Base64.NO_WRAP);
                attachmentBytes += data.length;
                if (attachmentOutput == null || attachmentBytes > 25L * 1024 * 1024) return false;
                attachmentOutput.write(data); return true;
            } catch (Exception error) { return false; }
        }
        @JavascriptInterface public synchronized boolean finishAttachment() {
            try {
                if (attachmentOutput == null) return false;
                attachmentOutput.getFD().sync(); attachmentOutput.close(); attachmentOutput = null;
                File temp = new File(attachmentDir, attachmentId + ".tmp");
                if (!temp.renameTo(new File(attachmentDir, attachmentId))) return false;
                try (FileOutputStream out = new FileOutputStream(new File(attachmentDir, attachmentId + ".mime"))) {
                    out.write(attachmentMime.getBytes(StandardCharsets.UTF_8)); out.getFD().sync();
                }
                return true;
            } catch (Exception error) { return false; }
        }
        @JavascriptInterface public synchronized boolean beginDownload(String name, String mime) {
            try {
                if (downloadOutput != null) downloadOutput.close();
                exportTemp = new File(getCacheDir(), "export.tmp");
                downloadOutput = new FileOutputStream(exportTemp); downloadBytes = 0;
                downloadName = name.replaceAll("[\\\\/\\p{Cntrl}]", "_");
                downloadMime = mime; return true;
            } catch (Exception error) { return false; }
        }
        @JavascriptInterface public synchronized boolean appendDownload(String value) {
            try {
                byte[] data = Base64.decode(value, Base64.NO_WRAP); downloadBytes += data.length;
                if (downloadOutput == null || downloadBytes > 160L * 1024 * 1024) return false;
                downloadOutput.write(data); return true;
            } catch (Exception error) { return false; }
        }
        @JavascriptInterface public synchronized void finishDownload() {
            try { downloadOutput.getFD().sync(); downloadOutput.close(); downloadOutput = null; }
            catch (Exception error) { downloadResult("备份文件写入失败"); return; }
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(downloadMime).putExtra(Intent.EXTRA_TITLE, downloadName);
                try { startActivityForResult(intent, SAVE_FILE); }
                catch (Exception error) { downloadResult("无法打开系统文件保存窗口"); }
            });
        }
        @JavascriptInterface public synchronized void pruneAttachments(String ids) {
            try {
                org.json.JSONArray array = new org.json.JSONArray(ids);
                Set<String> keep = new HashSet<>();
                for (int i = 0; i < array.length(); i++) if (validId(array.getString(i))) keep.add(array.getString(i));
                File[] files = attachmentDir.listFiles();
                if (files != null) for (File file : files) {
                    String id = file.getName().split("\\.")[0];
                    if (validId(id) && !keep.contains(id)) file.delete();
                }
            } catch (Exception ignored) {}
        }
        @JavascriptInterface public void background() { runOnUiThread(() -> moveTaskToBack(true)); }
        @JavascriptInterface public void printDocument(String html) {
            if (html == null || html.length() > 20 * 1024 * 1024) return;
            runOnUiThread(() -> {
                if (printWeb != null) printWeb.destroy();
                printWeb = new WebView(MainActivity.this);
                printWeb.getSettings().setJavaScriptEnabled(false);
                printWeb.getSettings().setAllowFileAccess(false);
                printWeb.setWebViewClient(new WebViewClient() {
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return blocked(); }
                    @Override public void onPageFinished(WebView view, String url) {
                        ((PrintManager)getSystemService(PRINT_SERVICE)).print("Inkstone 笔记", view.createPrintDocumentAdapter("Inkstone"), null);
                    }
                });
                printWeb.loadDataWithBaseURL(ORIGIN + "/", html, "text/html", "UTF-8", null);
            });
        }
    }
}
