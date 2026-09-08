package com.prowosma.backend.audit;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.ActivityLogRepository;
import com.prowosma.backend.repository.TaskRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Fix-4: Verify that ActivityLogService is correctly wired.
 *
 * Covers:
 *   T1  Creating a task via POST /api/tasks writes a TASK_CREATED audit log
 *   T2  Deleting a task writes a TASK_DELETED audit log
 *   T3  Creating a goal writes a GOAL_CREATED audit log
 *   T4  Severity is correctly set: TASK_DELETED → WARNING
 *   T5  humanReadable description is populated on each log entry
 */
@DisplayName("ActivityLogService — audit trail wiring")
class ActivityLogServiceTest extends ProwosmaTestBase {

    @Autowired private ActivityLogRepository activityLogRepository;
    @Autowired private TaskRepository        taskRepository;

    @Test
    @DisplayName("T1: POST /api/tasks writes TASK_CREATED audit log")
    void createTask_writesAuditLog() throws Exception {
        clearActivityLogs();

        mvc.perform(post("/api/tasks")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Audit Test\",\"status\":\"TODO\",\"priority\":\"HIGH\"}"))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs).isNotEmpty();
        assertThat(logs).anyMatch(l -> "TASK_CREATED".equals(l.getAction()));
    }

    @Test
    @DisplayName("T2: DELETE /api/tasks/{id} writes TASK_DELETED audit log")
    void deleteTask_writesAuditLog() throws Exception {
        // Create a task directly in repo
        Task task = new Task();
        task.setTitle("Delete Me");
        task.setStatus("TODO");
        task.setPriority("LOW");
        task.setOrganizationId(workspaceId);
        task = taskRepository.save(task);

        clearActivityLogs();

        mvc.perform(delete("/api/tasks/" + task.getId())
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs).anyMatch(l -> "TASK_DELETED".equals(l.getAction()));
    }

    @Test
    @DisplayName("T3: POST /api/goals writes GOAL_CREATED audit log")
    void createGoal_writesAuditLog() throws Exception {
        clearActivityLogs();

        mvc.perform(post("/api/goals")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Q1 Goal\",\"status\":\"ACTIVE\",\"progress\":0}"))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs).anyMatch(l -> "GOAL_CREATED".equals(l.getAction()));
    }

    @Test
    @DisplayName("T4: TASK_DELETED log has severity WARNING")
    void taskDeleted_hasSeverityWarning() throws Exception {
        Task task = new Task();
        task.setTitle("Severity Test");
        task.setStatus("TODO");
        task.setPriority("LOW");
        task.setOrganizationId(workspaceId);
        task = taskRepository.save(task);

        clearActivityLogs();

        mvc.perform(delete("/api/tasks/" + task.getId())
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs)
            .filteredOn(l -> "TASK_DELETED".equals(l.getAction()))
            .allMatch(l -> "WARNING".equals(l.getSeverity()));
    }

    @Test
    @DisplayName("T5: Audit log entries have humanReadable description populated")
    void auditLog_hasHumanReadable() throws Exception {
        clearActivityLogs();

        mvc.perform(post("/api/tasks")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Readable Test\",\"status\":\"TODO\",\"priority\":\"MEDIUM\"}"))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs)
            .filteredOn(l -> "TASK_CREATED".equals(l.getAction()))
            .allMatch(l -> l.getHumanReadable() != null && !l.getHumanReadable().isBlank());
    }
}
