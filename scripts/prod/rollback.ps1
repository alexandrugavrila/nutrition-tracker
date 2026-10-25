# Account cutover recovery must restore into a clean database.
throw 'Automatic rollback is disabled for the ownership cutover. Follow docs/release-cutover.md: preserve current data, restore to a clean database, and pair with recorded previous image IDs. No changes were made.'
