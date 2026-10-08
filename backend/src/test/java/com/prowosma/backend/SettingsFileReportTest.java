package com.prowosma.backend;

import com.prowosma.backend.config.SettingsFileReport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("Startup settings report")
class SettingsFileReportTest {

    private static String call(String name, Class<?> type, Object arg) throws Exception {
        Method m = SettingsFileReport.class.getDeclaredMethod(name, type);
        m.setAccessible(true);
        return (String) m.invoke(null, arg);
    }

    @Test @DisplayName("the database address is shown without its username, password or options")
    void neverRevealsCredentials() throws Exception {
        String shown = call("describeMongo", String.class, "mongodb+srv://admin:Sup3r%40Secret@cluster0.abc12.mongodb.net/mydb?retryWrites=true&w=majority");
        assertThat(shown).isEqualTo("mongodb+srv://cluster0.abc12.mongodb.net");
        assertThat(shown).doesNotContain("admin").doesNotContain("Sup3r").doesNotContain("retryWrites").doesNotContain("mydb");
    }

    @Test @DisplayName("a local or missing address is called out plainly")
    void flagsLocalAndMissing() throws Exception {
        assertThat(call("describeMongo", String.class, "mongodb://localhost:27017")).contains("localhost:27017").contains("no hosted database address");
        assertThat(call("describeMongo", String.class, "mongodb://user:pw@127.0.0.1:27017/x")).contains("no hosted database address").doesNotContain("pw");
        assertThat(call("describeMongo", String.class, "mongodb+srv://a:p@ss@host.example.net/db")).isEqualTo("mongodb+srv://host.example.net");   // even an unencoded '@' in the password stays hidden
        assertThat(call("describeMongo", String.class, null)).isEqualTo("NOT SET");
        assertThat(call("describeMongo", String.class, "  ")).isEqualTo("NOT SET");
        assertThat(call("describeMongo", String.class, "not a uri")).contains("not in a recognisable");
    }

    @Test @DisplayName("file checks report presence and size, never content")
    void fileChecks(@TempDir Path dir) throws Exception {
        Path f = dir.resolve(".env");
        assertThat(call("describe", Path.class, f)).isEqualTo("not found");
        Files.writeString(f, "JWT_SECRET=very-secret\n");
        assertThat(call("describe", Path.class, f)).isEqualTo("found (23 bytes)").doesNotContain("very-secret");
        assertThat(call("listNames", Path.class, dir)).isEqualTo(".env");
        assertThat(call("listNames", Path.class, dir.resolve("missing"))).isEqualTo("(folder not found)");
    }
}
