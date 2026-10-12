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
}
