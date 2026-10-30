export async function createMediaS3(env=process.env){
  const aws=await import('@aws-sdk/client-s3');
  const {getSignedUrl}=await import('@aws-sdk/s3-request-presigner');
  const client=new aws.S3Client({endpoint:env.MEDIA_S3_ENDPOINT||'https://s3.twcstorage.ru',region:env.MEDIA_S3_REGION||'ru-1',forcePathStyle:true,
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',maxAttempts:3,
    credentials:{accessKeyId:env.MEDIA_S3_ACCESS_KEY,secretAccessKey:env.MEDIA_S3_SECRET_KEY}});
  const Bucket=env.MEDIA_S3_BUCKET;
  const send=(command,input)=>client.send(new aws[command]({Bucket,...input}));
  return {
    async create(Key,ContentType){return (await send('CreateMultipartUploadCommand',{Key,ContentType})).UploadId;},
    async upload(Key,UploadId,PartNumber,ContentLength,Body,signal){return client.send(new aws.UploadPartCommand({Bucket,Key,UploadId,PartNumber,ContentLength,Body}),{abortSignal:signal});},
    async parts(Key,UploadId){let PartNumberMarker,items=[];do{const page=await send('ListPartsCommand',{Key,UploadId,PartNumberMarker});items.push(...page.Parts||[]);PartNumberMarker=page.IsTruncated?page.NextPartNumberMarker:undefined;}while(PartNumberMarker);return items;},
    async sign(Key,UploadId,PartNumber,ContentLength){return getSignedUrl(client,new aws.UploadPartCommand({Bucket,Key,UploadId,PartNumber,ContentLength}),{expiresIn:600});},
    async complete(Key,UploadId,Parts){await send('CompleteMultipartUploadCommand',{Key,UploadId,MultipartUpload:{Parts:Parts.map(({PartNumber,ETag})=>({PartNumber,ETag}))}});},
    async head(Key){return send('HeadObjectCommand',{Key});},
    async read(Key){return (await send('GetObjectCommand',{Key})).Body;},
    async remove(Key){await send('DeleteObjectCommand',{Key});},
    async abort(Key,UploadId){await send('AbortMultipartUploadCommand',{Key,UploadId});},
    async readUrl(Key){return getSignedUrl(client,new aws.GetObjectCommand({Bucket,Key}),{expiresIn:300});}
  };
}
