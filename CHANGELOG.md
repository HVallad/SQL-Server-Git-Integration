# Change Log

All notable changes to the "MSSQL Git Sync" extension will be documented in this file.

## [0.1.0] - 2025-10-01

### Added - Initial Release

#### Core Features
- **Database Scripting**: Script all database objects to files with a single click
- **Context Menu Integration**: Right-click on database nodes in MSSQL Object Explorer
- **Object Type Support**:
  - Tables
  - Views
  - Stored Procedures
  - User-Defined Functions (Scalar, Inline, Table-Valued)
  - Triggers
- **Organized Output**: Objects organized by type in separate folders
- **Unique Folder Naming**: Deterministic folder names based on connection details
- **Progress Reporting**: Real-time progress notifications during scripting
- **Error Handling**: Comprehensive error handling with user-friendly messages

### Fixed
- **Application Name Length Limit Error**: Fixed issue where SQL Server's 128-character limit for Application Name was exceeded, causing scripting to fail silently. The extension now overrides the application name with a short value ('MSSQL-Git-Sync') to ensure compatibility.

#### Technical Implementation
- Extension activation and MSSQL extension dependency verification
- Database object enumeration using system views
- Integration with MSSQL extension's scripting API
- File system operations for saving scripts
- Metadata generation (JSON file with scripting details)

#### Documentation
- README.md - User documentation
- QUICKSTART.md - Quick start guide for new users
- DEVELOPMENT.md - Technical documentation for developers
- Comprehensive inline code comments

#### Configuration
- TypeScript compilation setup
- ESLint configuration for code quality
- VS Code debugging configuration
- Build and watch scripts

### Dependencies
- Requires: `ms-mssql.mssql` extension
- VS Code Engine: `^1.98.0`

### Known Limitations
- System objects are excluded from scripting
- Output location is fixed to extension global storage
- No incremental update support (full scripting each time)
- No Git integration (manual Git operations required)

### Notes
- First public release
- Tested with SQL Server 2019 and Azure SQL Database
- Compatible with Windows, macOS, and Linux

---

## Future Releases (Planned)

### [0.2.0] - Planned
- Custom output directory selection
- Object filtering options
- Incremental updates (only script changed objects)

### [0.3.0] - Planned
- Git integration (auto-commit)
- Comparison with previous versions
- Support for additional object types (schemas, users, roles)

### [1.0.0] - Planned
- Stable release
- Performance optimizations
- Comprehensive testing suite
- CI/CD integration examples

---

## Version History

- **0.1.0** - Initial release with core scripting functionality

