# Changelog

## [0.4.0](https://github.com/mrijke/greenlight/compare/v0.3.0...v0.4.0) (2026-07-01)


### Features

* carry workflow name through the checks rollup ([8db7edf](https://github.com/mrijke/greenlight/commit/8db7edfe73eb804d3709e91226924979198bd74f))
* group the checks pane by workflow with collapsible headers ([59ece47](https://github.com/mrijke/greenlight/commit/59ece47bd542c891d5e2b0c2c7e2d7eea4b47a81))
* pure module for grouping checks by workflow ([2f8365f](https://github.com/mrijke/greenlight/commit/2f8365f5c8185cacf906165b84a6d476d9283049))

## [0.3.0](https://github.com/mrijke/greenlight/compare/v0.2.0...v0.3.0) (2026-07-01)


### Features

* fetch check counts and mergeable state for all PRs in the list query ([b339dba](https://github.com/mrijke/greenlight/commit/b339dba4286d4b0f8350e1ba537d1137649d0379))
* **ui:** flag PRs with merge conflicts in the list and detail pane ([087751f](https://github.com/mrijke/greenlight/commit/087751fd21ff0df1d06a7f9c7a3e4605c8214373))
* **ui:** mark selected check row with cursor arrow ([c228b08](https://github.com/mrijke/greenlight/commit/c228b083002ec2c4788455819685943f8686420a))


### Bug Fixes

* **store:** protect requeued PRs from list-poll clobber across navigation ([04d9157](https://github.com/mrijke/greenlight/commit/04d91573a5ca9aef2079b8deb8c52a7d2f839416))
* **ui:** budget the merge-conflict header row in computeLayout ([21766d5](https://github.com/mrijke/greenlight/commit/21766d53296972d51a90d53f6ec15c132146c3c1))

## [0.2.0](https://github.com/mrijke/greenlight/compare/v0.1.2...v0.2.0) (2026-06-30)


### Features

* **format:** windowRows reports hidden-row counts ([b180dce](https://github.com/mrijke/greenlight/commit/b180dcec3d35d09f341bca5b4aa82b3ad318c078))
* **ui:** add AnalysisPane pop-up, remove inline Analysis ([a6d91b5](https://github.com/mrijke/greenlight/commit/a6d91b54505a4408ec74eea52beb5ed218959f9d))
* **ui:** add computeLayout height-budget function ([7783640](https://github.com/mrijke/greenlight/commit/778364043b623de4114ad2a14059a5e4fa8eff2a))
* **ui:** add useTerminalSize hook ([8c8ddcd](https://github.com/mrijke/greenlight/commit/8c8ddcd8dbaaf56dd9cc15e3d659d25c3e52e940))
* **ui:** checks pane fills width, dynamic rows, overflow footer ([6e87229](https://github.com/mrijke/greenlight/commit/6e872292806284ed9cd0fc04c84cca9f501e5ba6))
* **ui:** PrList fills width, auto-sizes, shows overflow ([7f564a8](https://github.com/mrijke/greenlight/commit/7f564a89b45982dda89c23de4fed1b87571fa8fe))
* **ui:** vertical-stack layout with full-height panes and analysis pop-up ([34ce1fc](https://github.com/mrijke/greenlight/commit/34ce1fcd6e674217eb999e46c6b859b4f42fff7e))


### Bug Fixes

* layouting issues ([253e3af](https://github.com/mrijke/greenlight/commit/253e3af4d5fb3218de8df9e41f3f69f589f34adb))
* review fixes ([4dc2d70](https://github.com/mrijke/greenlight/commit/4dc2d702c513db502bfff95740d19118d74971d9))

## [0.1.2](https://github.com/mrijke/greenlight/compare/v0.1.1...v0.1.2) (2026-06-30)


### Bug Fixes

* report the real version and expand --help ([30d9fd0](https://github.com/mrijke/greenlight/commit/30d9fd0b22982a2dc575c548d2fab29b4d7acca8))

## [0.1.1](https://github.com/mrijke/greenlight/compare/v0.1.0...v0.1.1) (2026-06-30)


### Bug Fixes

* run the CLI when invoked through an installed bin symlink ([f4366d6](https://github.com/mrijke/greenlight/commit/f4366d6380c87319cd448b20b4752d26a8df42ab))
