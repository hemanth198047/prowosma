package com.prowosma.backend.integration;

import java.util.List;

/** An issue or merge request read from an external system, ready to become a task. */
public record ImportedItem(String kind, long iid, String title, String description,
                           String url, List<String> labels, String externalRef) { }
