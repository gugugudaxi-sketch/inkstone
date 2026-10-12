package dev.inkstone.local;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public final class ImportTestProvider extends ContentProvider {
    private File fixture(String name) {
        if (!"picker.md".equals(name) && !"picker.zip".equals(name)) throw new IllegalArgumentException("Unknown test fixture");
        return new File(getContext().getFilesDir(), name);
    }
    @Override public boolean onCreate() {
        try {
            try (FileOutputStream out = new FileOutputStream(fixture("picker.md"))) {
                out.write("# Android文件导入\n来自系统文件选择器".getBytes(StandardCharsets.UTF_8));
            }
            try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(fixture("picker.zip")))) {
                zip.putNextEntry(new ZipEntry("inkstone-export.json"));
                zip.write(("{\"format\":\"inkstone-export\",\"version\":1,\"folders\":[],\"tags\":[],\"attachments\":[],\"notes\":[{\"id\":\"01j00000000000000000000088\",\"title\":\"ZIP导入测试\",\"content\":\"ZIP系统导入\"}]}").getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
            return true;
        } catch (IOException error) { throw new RuntimeException(error); }
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fixture(uri.getLastPathSegment()), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        String[] columns = projection == null ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(uri.getLastPathSegment());
            else if (OpenableColumns.SIZE.equals(column)) row.add(fixture(uri.getLastPathSegment()).length());
            else row.add(null);
        }
        return cursor;
    }
    @Override public String getType(Uri uri) { return uri.getLastPathSegment().endsWith(".zip") ? "application/zip" : "text/markdown"; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
