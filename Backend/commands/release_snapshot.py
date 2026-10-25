"""Read-only schema/content evidence for cutover and restore verification."""

import json
from sqlalchemy import MetaData, select, text
from Backend.db import engine
from Backend.services.adoption import digest


def main():
    with engine.connect() as connection:
        connection.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
        metadata = MetaData()
        metadata.reflect(connection, schema='public')
        tables = {}
        for table in metadata.sorted_tables:
            rows = [dict(row) for row in connection.execute(select(table)).mappings()]
            # Only hashes and counts leave the container; no password hashes or personal payloads.
            tables[table.name] = {
                'count': len(rows),
                'sha256': digest(sorted(digest(row) for row in rows)),
                'ids_sha256': digest(
                    sorted(
                        digest(
                            {column.name: row[column.name] for column in table.primary_key.columns}
                        )
                        for row in rows
                    )
                ),
            }
        sequences = (
            connection.execute(
                text(
                    "SELECT sequencename, start_value, min_value, max_value, increment_by, cycle, cache_size, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename"
                )
            )
            .mappings()
            .all()
        )
        print(
            json.dumps(
                {
                    'sequences': [dict(row) for row in sequences],
                    'tables': tables,
                    'postgres_version': connection.execute(
                        text('SHOW server_version')
                    ).scalar_one(),
                },
                sort_keys=True,
            )
        )


if __name__ == '__main__':
    main()
