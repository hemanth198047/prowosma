package com.prowosma.backend.compliance;

import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies the account-deletion security fix: DELETE /api/users/me must
 * actually require the correct current password, matching what the
 * endpoint's own documentation always claimed — previously it only
 * checked the literal confirmation string, meaning a stolen/leaked JWT
 * alone was enough to permanently delete an account and everything it
 * owns, with zero knowledge of the account's actual password required.
 */
@DisplayName("Account deletion — password verification (GDPR self-service deletion)")
class AccountDeletionSecurityTest extends ProwosmaTestBase {

    @Test
    @DisplayName("Wrong password is rejected with 401, and the account is NOT deleted")
    void wrongPassword_rejectsAndPreservesAccount() throws Exception {
        mvc.perform(delete("/api/users/me")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"password\":\"totally-wrong-password\",\"confirmation\":\"DELETE MY ACCOUNT\"}"))
           .andExpect(status().isUnauthorized());

        // The account must still exist and still be able to authenticate —
        // this is the actual regression check, not just the status code.
        assertTrue(userRepository.findByEmail(ownerEmail).isPresent(),
            "Account must NOT be deleted when the password is wrong, regardless of a correct confirmation string");
    }

    @Test
    @DisplayName("Missing password field is rejected, not treated as an empty-but-valid password")
    void missingPassword_isRejected() throws Exception {
        mvc.perform(delete("/api/users/me")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"confirmation\":\"DELETE MY ACCOUNT\"}"))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Correct password + correct confirmation actually deletes the account")
    void correctPassword_deletesAccount() throws Exception {
        // ProwosmaTestBase creates the owner with password "pass" (see baseSetup()).
        mvc.perform(delete("/api/users/me")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"password\":\"pass\",\"confirmation\":\"DELETE MY ACCOUNT\"}"))
           .andExpect(status().isOk());

        assertTrue(userRepository.findByEmail(ownerEmail).isEmpty(),
            "Account must actually be deleted once both checks pass");
    }

    private void assertTrue(boolean condition, String message) {
        org.junit.jupiter.api.Assertions.assertTrue(condition, message);
    }
}
