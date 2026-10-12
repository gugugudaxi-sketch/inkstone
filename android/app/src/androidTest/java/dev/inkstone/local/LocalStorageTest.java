package dev.inkstone.local;

import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class LocalStorageTest {
    private android.app.Instrumentation getInstrumentation() { return InstrumentationRegistry.getInstrumentation(); }
    private String eval(WebView web, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        getInstrumentation().runOnMainSync(() -> web.evaluateJavascript(script, value -> { result.set(value); latch.countDown(); }));
        assertTrue("JavaScript callback timed out", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }
    private void assertSafeSystemBarBounds(MainActivity activity, WebView web) throws Exception {
        getInstrumentation().runOnMainSync(() -> {
            android.view.WindowInsets insets = activity.getWindow().getDecorView().getRootWindowInsets();
            android.graphics.Insets safe = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
            int[] position = new int[2]; web.getLocationOnScreen(position);
            assertTrue("Web content overlaps status bar or display cutout", position[1] >= safe.top);
            assertTrue("Web content overlaps left display cutout", position[0] >= safe.left);
            int height = activity.getWindow().getDecorView().getHeight();
            assertTrue("Web content overlaps navigation bar", position[1] + web.getHeight() <= height - safe.bottom);
        });
    }
    private void ready(WebView web) throws Exception {
        for (int i = 0; i < 300; i++) {
            if ("true".equals(eval(web, "typeof window.inkstoneNativeBack === 'function'"))) return;
            Thread.sleep(100);
        }
        fail("Local application did not start");
    }
    private String async(WebView web, String body) throws Exception {
        eval(web, "window.__result=null;(async()=>{" + body + "})().then(v=>window.__result=JSON.stringify(v)).catch(e=>window.__result='ERROR:'+e.message)");
        for (int i = 0; i < 200; i++) {
            String result = eval(web, "window.__result");
            if (!"null".equals(result)) return result;
            Thread.sleep(100);
        }
        fail("Local operation timed out"); return "";
    }
    @Test public void testOfflineVaultSurvivesReloadAndAttachmentsRender() throws Exception {
        ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class);
        AtomicReference<MainActivity> activity = new AtomicReference<>();
        scenario.onActivity(activity::set);
        WebView web = activity.get().webForTesting();
        ready(web);
        assertSafeSystemBarBounds(activity.get(), web);
        String created = async(web,
            "const r=await fetch('/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'01j00000000000000000000099',title:'离线测试',content:'本地持久化'})});" +
            "if(!r.ok)throw Error('note save failed');" +
            "const s=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({appearance:{theme:'dark'}})});" +
            "if(!s.ok)throw Error('settings save failed');" +
            "const f=new FormData();const binary=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII=');" +
            "f.append('file',new File([Uint8Array.from(binary,c=>c.charCodeAt(0))],'test.png',{type:'image/png'}));" +
            "const a=await(await fetch('/api/files',{method:'POST',body:f})).json();" +
            "return {saved:true,url:a.url};");
        assertTrue(created, created.contains("saved"));
        assertFalse(created, created.contains("ERROR"));
        eval(web, "window.__previousPage=true");
        getInstrumentation().runOnMainSync(web::reload);
        for (int i = 0; i < 100 && "true".equals(eval(web, "window.__previousPage === true")); i++) Thread.sleep(100);
        ready(web);
        assertSafeSystemBarBounds(activity.get(), web);
        String reopened = async(web,
            "const n=await(await fetch('/api/notes/01j00000000000000000000099')).json();" +
            "const s=await(await fetch('/api/settings')).json();const a=await(await fetch('/api/files')).json();" +
            "const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('attachment render failed'));image.src=a.files[0].url});" +
            "return {content:n.content,theme:s.appearance.theme,imageWidth:image.naturalWidth};");
        assertTrue(reopened, reopened.contains("本地持久化"));
        assertTrue(reopened, reopened.contains("dark"));
        assertTrue(reopened, reopened.contains("imageWidth"));
        assertFalse(reopened, reopened.contains("ERROR"));
        scenario.close();
    }
    @Test public void testSystemPickerFilesCanBeReadAndImported() throws Exception {
        ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class);
        AtomicReference<MainActivity> activity = new AtomicReference<>();
        scenario.onActivity(activity::set);
        WebView web = activity.get().webForTesting();
        ready(web);
        android.net.Uri markdown = android.net.Uri.parse("content://dev.inkstone.local.test.imports/picker.md");
        android.net.Uri archive = android.net.Uri.parse("content://dev.inkstone.local.test.imports/picker.zip");
        android.content.Intent selected = new android.content.Intent().setData(markdown);
        android.content.ClipData clip = android.content.ClipData.newRawUri("test files", markdown);
        clip.addItem(new android.content.ClipData.Item(archive));
        selected.setClipData(clip).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        assertEquals(2, MainActivity.selectedDocumentUris(android.app.Activity.RESULT_OK, selected).length);
        assertNull(MainActivity.selectedDocumentUris(android.app.Activity.RESULT_CANCELED, selected));
        android.content.IntentFilter filter = new android.content.IntentFilter(android.content.Intent.ACTION_OPEN_DOCUMENT);
        filter.addCategory(android.content.Intent.CATEGORY_OPENABLE); filter.addDataType("*/*");
        android.app.Instrumentation.ActivityMonitor picker = getInstrumentation().addMonitor(filter,
            new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK, selected), true);
        eval(web, "window.__pickerResult=null;const input=document.createElement('input');input.id='picker-test';input.type='file';input.multiple=true;input.style.cssText='position:fixed;left:20px;top:70px;width:200px;height:60px;z-index:999999;background:white';" +
            "input.onchange=async()=>{try{const form=new FormData();for(const file of input.files)form.append('file',file);const response=await fetch('/api/import',{method:'POST',body:form});window.__pickerResult=JSON.stringify(await response.json())}catch(e){window.__pickerResult='ERROR:'+e.message}};document.body.append(input)");
        String rectResult = eval(web, "JSON.stringify([document.getElementById('picker-test').getBoundingClientRect().left+30,document.getElementById('picker-test').getBoundingClientRect().top+30,devicePixelRatio])");
        org.json.JSONArray rect = new org.json.JSONArray((String)new org.json.JSONTokener(rectResult).nextValue());
        int[] location = new int[2]; getInstrumentation().runOnMainSync(() -> web.getLocationOnScreen(location));
        float x = (float)(location[0]+rect.getDouble(0)*rect.getDouble(2));
        float y = (float)(location[1]+rect.getDouble(1)*rect.getDouble(2));
        long time = android.os.SystemClock.uptimeMillis();
        getInstrumentation().sendPointerSync(android.view.MotionEvent.obtain(time,time,android.view.MotionEvent.ACTION_DOWN,x,y,0));
        getInstrumentation().sendPointerSync(android.view.MotionEvent.obtain(time,time+100,android.view.MotionEvent.ACTION_UP,x,y,0));
        String result = "null";
        for(int i=0;i<150;i++){result=eval(web,"window.__pickerResult");if(!"null".equals(result))break;Thread.sleep(100);}
        getInstrumentation().removeMonitor(picker);
        assertFalse("Picker did not deliver a change event", "null".equals(result));
        assertFalse(result, result.contains("ERROR"));
        assertTrue(result, result.contains("createdNotes"));
        String notes = async(web,"return await(await fetch('/api/notes')).json()");
        assertTrue(notes, notes.contains("Android文件导入"));
        assertTrue(notes, notes.contains("ZIP导入测试"));
        scenario.close();
    }

}
