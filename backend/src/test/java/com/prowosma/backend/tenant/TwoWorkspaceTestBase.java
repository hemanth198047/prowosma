package com.prowosma.backend.tenant;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.User;
import com.prowosma.backend.model.Workspace;
import org.junit.jupiter.api.BeforeEach;

import java.util.UUID;

/**
 * ProwosmaTestBase seeds ONE workspace (owner / admin / member). Tenant-isolation
 * tests need a second, unrelated workspace with its own owner, so that "someone
 * else's data" is real data in the database, not an imagined id.
 */
public abstract class TwoWorkspaceTestBase extends ProwosmaTestBase {

    protected final String otherOwnerEmail = "other-owner@test.com";
    protected String otherWorkspaceId;

    @BeforeEach
    void seedOtherWorkspace() {
        User otherOwner = new User();
        otherOwner.setEmail(otherOwnerEmail);
        otherOwner.setName("Other Owner");
        otherOwner.setPassword(passwordEncoder.encode("pass"));
        otherOwner.setRole("USER");
        userRepository.save(otherOwner);

        Workspace other = new Workspace();
        other.setId(UUID.randomUUID().toString());
        other.setName("Other Workspace");
        other.setOwnerEmail(otherOwnerEmail);
        other.setCurrency("INR");
        other.setDateFormat("DD/MM/YYYY");
        otherWorkspaceId = workspaceRepository.save(other).getId();
    }

    protected String otherOwnerToken() {
        return jwtUtil.generateToken(otherOwnerEmail);
    }
}
