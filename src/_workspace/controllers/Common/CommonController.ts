import { CommonModel } from '@src/_workspace/models/Common/CommonModel'
import { ResponseI } from '@src/types/ResponseI'
import { Request, Response } from 'express'
import fs from 'fs'
import path from 'path'

export const CommonController = {
  GetByLikeMonthShortNameEnglish: async (req: Request, res: Response) => {
    let dataItem

    if (!req.body || Object.entries(req.body).length === 0) {
      dataItem = req.query
    } else {
      dataItem = req.body
    }

    const result = await CommonModel.GetByLikeMonthShortNameEnglish(dataItem)

    res.json({
      Status: true,
      Message: 'GetByLikeMonthShortNameEnglish Data Success',
      ResultOnDb: result,
      MethodOnDb: 'GetByLikeMonthShortNameEnglish',
      TotalCountOnDb: 0,
    } as ResponseI)
  },
  getImageByUrl: async (req: Request, res: Response) => {
    let dataItem

    if (!req.body || Object.entries(req.body).length === 0) {
      dataItem = req.query
    } else {
      dataItem = req.body
    }

    if (dataItem !== '') {
      const picPath = dataItem['URL_PATH']
      fs.readFile(path.resolve(picPath), (error, data) => {
        if (error)
          return res.send({
            Message: error,
            Status: false,
          })
        res.writeHead(200, { 'Content-Type': 'image/jpg' })
        res.end(data, 'utf8')
      })
    }
  },
  getImageFromUrl: async (req: Request, res: Response) => {
    let dataItem

    if (!req.body || Object.entries(req.body).length === 0) {
      dataItem = req.query
    } else {
      dataItem = req.body
    }
    const itemCode = dataItem['URL_PATH']

    fs.readFile(
      // path.join(
      //   '\\\\192.168.14.35\\C20_Smart_Factory\\WG04_Smart-FFT\\08_Master Data System\\02_Requirement\\Picture-for-item-code\\Item-master-picture',
      //   itemCode,
      //   `${itemCode}_3.jpg`
      // ),
      path.join('/mnt/C20_Smart_Factory/WG04_Smart-FFT/08_Master Data System/02_Requirement/Picture-for-item-code/Item-master-picture', itemCode, `${itemCode}_3.jpg`),
      (error, data) => {
        if (error) {
          res.writeHead(404, { 'Content-Type': 'image/jpg' })
          res.end('No such image')
        } else {
          res.writeHead(200, { 'Content-Type': 'image/jpg' })
          res.end(data, 'utf8')
        }
      }
    )
  },
  getImageArrayFromUrl: async (req: Request, res: Response) => {
    const dataItem = req.body

    if (dataItem !== '') {
      const itemCode = dataItem['URL_PATH']

      fs.readdir(
        //path.join(`\\\\192.168.14.35\\C20_Smart_Factory\\WG04_Smart-FFT\\08_Master Data System\\02_Requirement\\Picture-for-item-code\\Item-master-picture\\${itemCode}`),
        path.join(`/mnt/C20_Smart_Factory/WG04_Smart-FFT/08_Master Data System/02_Requirement/Picture-for-item-code/Item-master-picture/${itemCode}`),
        (error, files) => {
          if (error) {
            return res.status(404).json({
              Status: false,
              Message: 'No such image folder or item code not found',
              data: [{ Status: false }],
            })
          }

          const filteredFiles = files.filter((file) => file.toLowerCase().endsWith('.jpg'))

          if (filteredFiles.length === 0) {
            return res.status(200).json({
              Status: false,
              Message: 'No JPG images found',
              data: [{ Status: false }],
            })
          }

          const result = filteredFiles.map((fileName) => {
            const imageBuffer = fs.readFileSync(
              // path.join(
              //   `\\\\192.168.14.35\\C20_Smart_Factory\\WG04_Smart-FFT\\08_Master Data System\\02_Requirement\\Picture-for-item-code\\Item-master-picture\\${itemCode}
              // \\${fileName}`
              // )
              path.join(`/mnt/C20_Smart_Factory/WG04_Smart-FFT/08_Master Data System/02_Requirement/Picture-for-item-code/Item-master-picture/${itemCode}/${fileName}`)
            )
            return {
              Status: true, // ✅ Status per image
              data: Array.from(imageBuffer),
            }
          })

          res.status(200).json({
            Status: true,
            data: result,
          })
        }
      )
    } else {
      res.status(400).json({
        Status: false,
        Message: 'Invalid request body',
        data: [{ Status: false }],
      })
    }
  },

  GetYearNow: async (req: Request, res: Response) => {
    let result = await CommonModel.GetYearNow()
    res.send({
      Status: true,
      Message: 'Search Data Success',
      ResultOnDb: result,
      MethodOnDb: 'Search GetYearNow',
      TotalCountOnDb: '',
    })
  },
  getImageEmployeeFromUrl: async (req: Request, res: Response) => {
    let dataItem

    if (!req.body || Object.entries(req.body).length === 0) {
      dataItem = req.query
    } else {
      dataItem = req.body
    }
    const employeeCode = dataItem['URL_PATH']

    fs.readFile(
      //path.join('\\\\192.168.14.35\\s09_hr\\16_Employee Photo\\02_furukawa', `${employeeCode}.jpg`),
      path.join('/mnt/s09_hr/16_Employee Photo/02_furukawa', `${employeeCode}.jpg`),
      (error, data) => {
        if (error) {
          res.writeHead(404, { 'Content-Type': 'image/jpg' })
          res.end('No such image')
        } else {
          res.writeHead(200, { 'Content-Type': 'image/jpg' })
          res.end(data, 'utf8')
        }
      }
    )
  },
}
