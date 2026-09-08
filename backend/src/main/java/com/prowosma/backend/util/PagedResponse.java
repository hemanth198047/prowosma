package com.prowosma.backend.util;

import java.util.List;

/**
 * Standard paginated response wrapper.
 * All list endpoints return this shape so the frontend can always
 * read {@code .data}, {@code .page}, {@code .size}, {@code .totalElements}.
 */
public record PagedResponse<T>(
        List<T>  data,
        int      page,
        int      size,
        long     totalElements,
        int      totalPages,
        boolean  hasNext
) {
    public static <T> PagedResponse<T> of(org.springframework.data.domain.Page<T> p) {
        return new PagedResponse<>(
                p.getContent(),
                p.getNumber(),
                p.getSize(),
                p.getTotalElements(),
                p.getTotalPages(),
                p.hasNext()
        );
    }

    /** Convenience for controllers that still load a full list in memory
     *  (e.g. when filtering requires all data). Applies in-memory paging. */
    public static <T> PagedResponse<T> ofList(List<T> allItems, int page, int size) {
        int total  = allItems.size();
        int from   = Math.min(page * size, total);
        int to     = Math.min(from + size, total);
        int pages  = size == 0 ? 1 : (int) Math.ceil((double) total / size);
        return new PagedResponse<>(
                allItems.subList(from, to),
                page,
                size,
                total,
                pages,
                to < total
        );
    }
}
