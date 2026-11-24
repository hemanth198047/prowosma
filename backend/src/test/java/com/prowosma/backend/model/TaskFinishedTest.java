package com.prowosma.backend.model;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TaskFinishedTest {
    @Test
    void closedTasksAreFinishedWhateverTheCase() {
        for (String s : new String[]{"DONE", "done", " Done ", "CANCELLED", "CLOSED", "COMPLETED", "RESOLVED"})
            assertThat(Task.isFinished(s)).as(s).isTrue();
        for (String s : new String[]{"TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "", null})
            assertThat(Task.isFinished(s)).as(String.valueOf(s)).isFalse();
    }
}
