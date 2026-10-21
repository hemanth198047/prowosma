package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.StandupEntry;
import com.prowosma.backend.repository.StandupRepository;
import com.prowosma.backend.util.PagedResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.List;

@RestController @RequestMapping("/api/standup") @RequiredArgsConstructor
public class StandupController {
    private final StandupRepository repo;
    private final WorkspaceContext  ws;
    private final com.prowosma.backend.service.VisibilityService visibility;

    @GetMapping  public List<StandupEntry> getAll() {
        // the team's stand-up is theirs to read; a restricted person sees only their own entries
        return visibility.filterLinked(repo.findByOrganizationIdOrderByCreatedAtDesc(ws.getWorkspaceId()),
                x -> com.prowosma.backend.service.VisibilityService.people(x.getAuthorEmail()), x -> new java.util.ArrayList<String>());
    }

    @PostMapping public StandupEntry create(@RequestBody StandupEntry e, Authentication auth) {
        e.setOrganizationId(ws.getWorkspaceId());
        e.setAuthorEmail(auth.getName());
        e.setCreatedAt(LocalDateTime.now());
        return repo.save(e);
    }
}
