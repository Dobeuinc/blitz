import {loadEnvConfig} from "../../env-utils"
import prompts from "prompts"
import path from "path"
import chalk from "chalk"
import hasbin from "hasbin"
import {cliCommand} from "../index"
import arg from "arg"
import {AppGenerator, AppGeneratorOptions, getLatestVersion} from "@blitzjs/generator"
import {runPrisma} from "../../prisma-utils"

enum TForms {
  "react-final-form" = "React Final Form",
  "react-hook-form" = "React Hook Form",
  "formik" = "Formik",
}
enum TLanguage {
  "typescript" = "TypeScript",
  "javascript" = "Javascript",
}
type TPkgManager = "npm" | "yarn" | "pnpm"
enum TTemplate {
  "full" = "full",
  "minimal" = "minimal",
}

const templates: {[key in TTemplate]: AppGeneratorOptions["template"]} = {
  full: {
    path: "app",
  },
  minimal: {
    path: "minimalapp",
    skipForms: true,
    skipDatabase: true,
  },
}

const IS_YARN_INSTALLED = hasbin.sync("yarn")
const IS_PNPM_INSTALLED = hasbin.sync("pnpm")
const PREFERABLE_PKG_MANAGER: TPkgManager = IS_PNPM_INSTALLED
  ? "pnpm"
  : IS_YARN_INSTALLED
  ? "yarn"
  : "npm"

const args = arg(
  {
    // Types
    "--name": String,
    "--npm": Boolean,
    "--yarn": Boolean,
    "--pnpm": Boolean,
    "--form": String,
    "--language": String,
    "--template": String,
    "--skip-install": Boolean,
    "--dry-run": Boolean,
    "--no-git": Boolean,
    "--skip-upgrade": Boolean,
  },
  {
    permissive: true,
  },
)

let projectName: string = ""
let projectPath: string = ""
let projectLanguage: string | TLanguage = ""
let projectFormLib: AppGeneratorOptions["form"] = undefined
let projectTemplate: AppGeneratorOptions["template"] = templates.full
let projectPkgManger: TPkgManager = PREFERABLE_PKG_MANAGER
let shouldInstallDeps: boolean = true

const determineProjectName = async () => {
  if (!args["--name"]) {
    const res = await prompts({
      type: "text",
      name: "name",
      message: "What would you like to name your project?",
      initial: "blitz-app",
    })

    projectName = res.name.trim().replaceAll(" ", "-")
    projectPath = path.resolve(projectName)
  } else {
    projectName = args["--name"]
    projectPath = path.resolve(projectName)
  }
}

const determineLanguage = async () => {
  // Check if language from flag is valid
  if (
    !args["--language"] ||
    (args["--language"] && !Object.keys(TLanguage).includes(args["--language"].toLowerCase()))
  ) {
    const res = await prompts({
      type: "select",
      name: "language",
      message: "Pick which language you'd like to use for your new blitz project",
      initial: 0,
      choices: Object.entries(TLanguage).map((c) => {
        return {title: c[1], value: c[1]}
      }),
    })

    projectLanguage = res.language
  } else {
    projectLanguage = args["--language"]
  }
}

const determineFormLib = async () => {
  // Check if form from flag is valid
  if (!args["--form"] || (args["--form"] && !Object.keys(TForms).includes(args["--form"]))) {
    const res = await prompts({
      type: "select",
      name: "form",
      message: "Pick which form you'd like to use for your new blitz project",
      initial: 0,
      choices: Object.entries(TForms).map((c) => {
        return {title: c[1], value: c[1]}
      }),
    })

    projectFormLib = res.form
  } else {
    switch (args["--form"]) {
      case "react-final-form":
        projectFormLib = TForms["react-final-form"]
      case "react-hook-form":
        projectFormLib = TForms["react-hook-form"]
      case "formik":
        projectFormLib = TForms["formik"]
    }
  }
}

const determineTemplate = async () => {
  // Check if template from flag is valid
  if (
    !args["--template"] ||
    (args["--template"] && !Object.keys(TTemplate).includes(args["--template"].toLowerCase()))
  ) {
    const res = await prompts({
      type: "select",
      name: "template",
      message: "Pick which template you'd like to use for your new blitz project",
      initial: 0,
      choices: Object.entries(TTemplate).map((c) => {
        return {title: c[1], value: c[1]}
      }),
    })

    projectTemplate = templates[res.template as TTemplate]
  } else {
    projectTemplate = templates[args["--template"] as TTemplate]
  }
}

const determinePkgManagerToInstallDeps = async () => {
  if (args["--skip-install"]) {
    shouldInstallDeps = false
    return
  }

  const isPkgManagerSpecifiedAsFlag = args["--npm"] || args["--yarn"] || args["--pnpm"]
  if (isPkgManagerSpecifiedAsFlag) {
    if (args["--npm"]) {
      projectPkgManger = "npm"
    } else if (args["--pnpm"]) {
      if (IS_PNPM_INSTALLED) {
        projectPkgManger = "pnpm"
      } else {
        console.warn(`Pnpm is not installed. Fallback to ${projectPkgManger}`)
      }
    } else if (args["--yarn"]) {
      if (IS_YARN_INSTALLED) {
        projectPkgManger = "yarn"
      } else {
        console.warn(`Yarn is not installed. Fallback to ${projectPkgManger}`)
      }
    }
  } else {
    const hasPkgManagerChoice = IS_YARN_INSTALLED || IS_PNPM_INSTALLED
    if (hasPkgManagerChoice) {
      const res = await prompts({
        type: "select",
        name: "pkgManager",
        message: "Install dependencies?",
        initial: 0,
        choices: [
          {title: "npm"},
          {title: "yarn", disabled: !IS_YARN_INSTALLED},
          {title: "pnpm", disabled: !IS_PNPM_INSTALLED},
          {title: "skip"},
        ],
      })

      if (res.pkgManager === "skip") {
        shouldInstallDeps = false
      } else {
        shouldInstallDeps = res.pkgManager
      }
    } else {
      const res = await prompts({
        type: "confirm",
        name: "installDeps",
        message: "Install dependencies?",
        initial: true,
      })
      shouldInstallDeps = res.installDeps
    }
  }
}

const newApp: cliCommand = async (argv) => {
  const shouldUpgrade = !args["--skip-upgrade"]
  if (shouldUpgrade) {
    //TODO: Handle checking for updates
  }

  await determineProjectName()
  await determineLanguage()
  await determineTemplate()
  await determinePkgManagerToInstallDeps()
  if (!projectTemplate.skipForms) {
    await determineFormLib()
  }

  try {
    const latestBlitzVersion = (await getLatestVersion("blitz")).value
    const requireManualInstall = args["--dry-run"] || !shouldInstallDeps
    const postInstallSteps = args["--name"] === "." ? [] : [`cd ${projectName}`]

    const generatorOpts: AppGeneratorOptions = {
      template: projectTemplate,
      destinationRoot: projectPath,
      appName: projectName,
      useTs: projectLanguage === "TypeScript",
      yarn: projectPkgManger === "yarn",
      pnpm: projectPkgManger === "pnpm",
      dryRun: args["--dry-run"] ? args["--dry-run"] : false,
      skipGit: args["--no-git"] ? args["--no-git"] : false,
      skipInstall: !shouldInstallDeps,
      version: latestBlitzVersion,
      form: projectFormLib,
      onPostInstall: async () => {
        if (projectTemplate.skipDatabase) {
          return
        }
        try {
          // loadEnvConfig is required in order for DATABASE_URL to be available
          // don't print info logs from loadEnvConfig for clear output
          loadEnvConfig(
            process.cwd(),
            undefined,
            {error: console.error, info: () => {}},
            {ignoreCache: true},
          )
          const result = await runPrisma(["migrate", "dev", "--name", "Initial migration"], true)
          if (!result.success) throw new Error()
        } catch (error) {
          postInstallSteps.push(
            "blitz prisma migrate dev (when asked, you can name the migration anything)",
          )
        }
      },
    }

    const generator = new AppGenerator(generatorOpts)
    console.log(`Hang tight while we set up your new Blitz app!`)
    await generator.run()

    if (requireManualInstall) {
      let cmd
      switch (projectPkgManger) {
        case "yarn":
          cmd = "yarn"
        case "npm":
          cmd = "npm install"
        case "pnpm":
          cmd = "pnpm install"
      }
      postInstallSteps.push(cmd)
      postInstallSteps.push(
        "blitz prisma migrate dev (when asked, you can name the migration anything)",
      )
    }

    postInstallSteps.push("blitz dev")

    console.log("Your new Blitz app is ready! Next steps:")
    postInstallSteps.forEach((step, index) => {
      console.log(chalk.yellow(`   ${index + 1}. ${step}`))
    })
    console.log("") // new line
  } catch (error) {
    console.error(error)
  }
}

export {newApp}