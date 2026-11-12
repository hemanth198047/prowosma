package com.prowosma.backend.service;

import com.prowosma.backend.model.Project;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ProjectServiceTeamTest {

    private Project.TeamEntry entry(String email, String role) {
        Project.TeamEntry t = new Project.TeamEntry();
        t.setEmail(email);
        t.setProjectRole(role);
        return t;
    }

    @Test
    void pruneKeepsOnlyCurrentMembersInMemberOrder() {
        List<Project.TeamEntry> details = List.of(entry("a@x.com", "PM"), entry("gone@x.com", "Dev"), entry("B@x.com", "QA"));
        List<Project.TeamEntry> out = ProjectService.pruneTeamDetails(List.of("b@x.com", "a@x.com", "new@x.com"), details);
        assertEquals(List.of("B@x.com", "a@x.com"), out.stream().map(Project.TeamEntry::getEmail).toList());
    }

    @Test
    void pruneHandlesNulls() {
        assertTrue(ProjectService.pruneTeamDetails(null, List.of(entry("a@x.com", null))).isEmpty());
        assertTrue(ProjectService.pruneTeamDetails(List.of("a@x.com"), null).isEmpty());
    }

    @Test
    void roleIsTrimmedAndCapped() {
        assertNull(ProjectService.cleanRole("  "));
        assertNull(ProjectService.cleanRole(42));
        assertEquals("Designer", ProjectService.cleanRole(" Designer "));
        assertEquals(60, ProjectService.cleanRole("x".repeat(80)).length());
    }

    @Test
    void allocationIsClampedTo0To100() {
        assertNull(ProjectService.cleanAllocation("50"));
        assertEquals(50, ProjectService.cleanAllocation(50));
        assertEquals(100, ProjectService.cleanAllocation(140));
        assertEquals(0, ProjectService.cleanAllocation(-5));
        assertEquals(33, ProjectService.cleanAllocation(33.4));
    }
}
