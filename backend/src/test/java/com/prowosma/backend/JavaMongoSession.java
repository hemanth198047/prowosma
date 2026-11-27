package com.prowosma.backend;

import de.bwaldvogel.mongo.MongoServer;
import de.bwaldvogel.mongo.backend.memory.MemoryBackend;
import org.junit.platform.launcher.LauncherSession;
import org.junit.platform.launcher.LauncherSessionListener;

import java.net.InetSocketAddress;

/**
 * Starts a MongoDB-compatible server (pure Java, in memory) once for the whole test run when {@code TEST_MONGO_JAVA=true}, and points the
 * tests at it. Without the flag nothing changes: tests use Flapdoodle's embedded mongod as before. Exists so the suite runs on machines that
 * cannot download a mongod binary (locked-down networks, CI without internet).
 */
public class JavaMongoSession implements LauncherSessionListener {
    private MongoServer server;

    @Override
    public void launcherSessionOpened(LauncherSession session) {
        if (!"true".equalsIgnoreCase(System.getenv("TEST_MONGO_JAVA"))) return;
        server = new MongoServer(new MemoryBackend());
        InetSocketAddress address = server.bind();
        System.setProperty("spring.mongodb.uri", "mongodb://" + address.getHostString() + ":" + address.getPort() + "/prowosma_test");
        // Don't start (or download) Flapdoodle's mongod: the Java server above is the database.
        System.setProperty("spring.autoconfigure.exclude", "de.flapdoodle.embed.mongo.spring.autoconfigure.EmbeddedMongoAutoConfiguration");
    }

    @Override
    public void launcherSessionClosed(LauncherSession session) {
        if (server != null) server.shutdownNow();
    }
}
